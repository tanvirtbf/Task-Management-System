import { AwsClient } from "aws4fetch";
import type { Logger } from "winston";
import { Config } from "../config";

/**
 * Cloudflare R2 object storage (S3-compatible) — the single client shared by the
 * §16 attachment endpoints and the §30 janitor jobs. Signing is done with
 * `aws4fetch` (SigV4 over WebCrypto) instead of the Node-only `@aws-sdk/*`
 * packages: presigned URLs are query-signed Requests, real operations are
 * header-signed `fetch` calls against the path-style endpoint
 * `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`.
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

export class R2Service {
    /** `null` ⇒ no-network test/dev transport (see class doc). */
    private readonly client: AwsClient | null;
    private readonly bucket: string;
    /** `https://<account>.r2.cloudflarestorage.com` — `""` under the stub. */
    private readonly endpoint: string;

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
            this.endpoint = "";
            this.logger.debug("r2.transport.stub", {
                reason: Config.NODE_ENV === "test" ? "test" : "unconfigured",
            });
        } else {
            // `configured` guarantees these are set; assert for the compiler.
            this.client = new AwsClient({
                accessKeyId: accessKeyId as string,
                secretAccessKey: secretAccessKey as string,
                service: "s3",
                region: "auto",
            });
            this.endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
        }
    }

    private get isStub(): boolean {
        return this.client === null;
    }

    /** Absolute path-style object URL: `<endpoint>/<bucket>/<key>`. */
    private objectUrl(key: string): string {
        const encodedKey = key.split("/").map(encodeURIComponent).join("/");
        return `${this.endpoint}/${this.bucket}/${encodedKey}`;
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
        const target = new URL(this.objectUrl(key));
        target.searchParams.set("X-Amz-Expires", String(opts.expiresIn));
        // Content-Type is signed into the URL, pinning what the uploader must
        // send — same behaviour as the old SDK presigner's `ContentType`.
        const signed = await this.client!.sign(
            new Request(target.toString(), {
                method: "PUT",
                headers: { "Content-Type": opts.contentType },
            }),
            { aws: { signQuery: true } },
        );
        return {
            url: signed.url,
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
        const res = await this.client!.fetch(this.objectUrl(key), {
            method: "PUT",
            headers: { "Content-Type": contentType },
            // Buffer IS a Uint8Array at runtime; the cast only bridges Node's
            // `ArrayBufferLike` generic vs DOM `BodyInit` (avoids a copy).
            body: body as unknown as BodyInit,
        });
        if (!res.ok) {
            throw new Error(`R2 PUT failed (HTTP ${res.status}) for ${key}`);
        }
    }

    /** A short-lived signed GET URL — backs `Attachment.url` + the download 302. */
    async presignGet(
        key: string,
        opts: { expiresIn: number },
    ): Promise<string> {
        if (this.isStub) {
            return `https://r2.fake/get/${encodeURIComponent(key)}?sig=test`;
        }
        const target = new URL(this.objectUrl(key));
        target.searchParams.set("X-Amz-Expires", String(opts.expiresIn));
        const signed = await this.client!.sign(
            new Request(target.toString(), { method: "GET" }),
            { aws: { signQuery: true } },
        );
        return signed.url;
    }

    /** Whether the object exists (and its size/type), via a HEAD — for finalize. */
    async headObject(key: string): Promise<HeadResult> {
        if (this.isStub) {
            // Default test transport assumes the upload landed; the "missing"
            // branch is exercised by spying this method.
            return { exists: true };
        }
        const res = await this.client!.fetch(this.objectUrl(key), {
            method: "HEAD",
        });
        if (res.status === 404) return { exists: false };
        if (!res.ok) {
            throw new Error(`R2 HEAD failed (HTTP ${res.status}) for ${key}`);
        }
        const contentLength = res.headers.get("content-length");
        return {
            exists: true,
            sizeBytes:
                contentLength != null ? Number(contentLength) : undefined,
            contentType: res.headers.get("content-type") ?? undefined,
        };
    }

    /** Hard-delete an object — used by the §30 r2-purge janitor, not the API. */
    async deleteObject(key: string): Promise<void> {
        if (this.isStub) return;
        const res = await this.client!.fetch(this.objectUrl(key), {
            method: "DELETE",
        });
        // S3 DELETE is idempotent (204 even for absent keys) — non-2xx is real.
        if (!res.ok) {
            throw new Error(`R2 DELETE failed (HTTP ${res.status}) for ${key}`);
        }
    }
}
