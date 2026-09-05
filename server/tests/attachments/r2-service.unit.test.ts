import logger from "../../src/config/logger";
import { R2Service } from "../../src/services/R2Service";

/**
 * Pure unit tests for R2Service's deterministic test transport + key builder.
 * Under NODE_ENV=test the service makes ZERO network calls (no S3 client), so
 * these run without a bucket and pin the stub contract the integration suite
 * relies on (https://r2.fake/* URLs, headObject default, no-op delete).
 */
describe("R2Service (unit — stub transport)", () => {
    const r2 = new R2Service(logger);

    describe("buildKey", () => {
        it("is workspace-scoped with the MIME extension", () => {
            expect(r2.buildKey("ws-1", "att-9", "jpg")).toBe(
                "workspaces/ws-1/attachments/att-9.jpg",
            );
        });

        it("omits the trailing dot when the extension is empty", () => {
            expect(r2.buildKey("ws-1", "att-9", "")).toBe(
                "workspaces/ws-1/attachments/att-9",
            );
        });
    });

    describe("stub transport (no network)", () => {
        it("presignPut returns a fake PUT URL with the Content-Type pinned", async () => {
            const out = await r2.presignPut("k/x.jpg", {
                contentType: "image/jpeg",
                expiresIn: 900,
            });
            expect(out.url).toContain("https://r2.fake/put/");
            expect(out.fields["Content-Type"]).toBe("image/jpeg");
            expect(out.fields.key).toBe("k/x.jpg");
            expect(out.expiresIn).toBe(900);
        });

        it("presignGet returns a fake GET URL", async () => {
            const url = await r2.presignGet("k/x.jpg", { expiresIn: 300 });
            expect(url).toContain("https://r2.fake/get/");
            expect(url).toContain("sig=test");
        });

        it("headObject defaults to exists:true", async () => {
            expect(await r2.headObject("k/x.jpg")).toEqual({ exists: true });
        });

        it("deleteObject resolves without error (no-op)", async () => {
            await expect(r2.deleteObject("k/x.jpg")).resolves.toBeUndefined();
        });
    });

    /**
     * KI-19. Every one of these used to return a plausible fake instead, which
     * is how an upload could succeed with nothing behind it. The refusal is
     * per-CALL, so a service constructed while storage was fine still refuses
     * once the mode says fakes are not acceptable.
     */
    describe("refuses to fake it when the stub is not allowed", () => {
        const withoutStub = (fn: () => Promise<void>) => async () => {
            const prev = process.env.STORAGE_ALLOW_STUB;
            process.env.STORAGE_ALLOW_STUB = "0";
            try {
                await fn();
            } finally {
                if (prev === undefined) delete process.env.STORAGE_ALLOW_STUB;
                else process.env.STORAGE_ALLOW_STUB = prev;
            }
        };

        const expect503 = async (p: Promise<unknown>) => {
            await expect(p).rejects.toMatchObject({
                statusCode: 503,
                code: "storage.unavailable",
            });
        };

        it(
            "presignPut",
            withoutStub(async () => {
                await expect503(
                    r2.presignPut("k/x.jpg", {
                        contentType: "image/jpeg",
                        expiresIn: 900,
                    }),
                );
            }),
        );

        it(
            "putObject — the one that used to throw the bytes away",
            withoutStub(async () => {
                await expect503(
                    r2.putObject("k/x.jpg", Buffer.from("bytes"), "image/jpeg"),
                );
            }),
        );

        it(
            "presignGet",
            withoutStub(async () => {
                await expect503(r2.presignGet("k/x.jpg", { expiresIn: 300 }));
            }),
        );

        it(
            "headObject — never claims an object exists it cannot see",
            withoutStub(async () => {
                await expect503(r2.headObject("k/x.jpg"));
            }),
        );

        it(
            "deleteObject",
            withoutStub(async () => {
                await expect503(r2.deleteObject("k/x.jpg"));
            }),
        );

        it("buildKey still works — it is pure string arithmetic, not storage", () => {
            const prev = process.env.STORAGE_ALLOW_STUB;
            process.env.STORAGE_ALLOW_STUB = "0";
            try {
                expect(r2.buildKey("ws-1", "att-9", "jpg")).toBe(
                    "workspaces/ws-1/attachments/att-9.jpg",
                );
            } finally {
                if (prev === undefined) delete process.env.STORAGE_ALLOW_STUB;
                else process.env.STORAGE_ALLOW_STUB = prev;
            }
        });
    });
});
