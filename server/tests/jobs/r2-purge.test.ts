import { oneOff } from "../test-utils/app";
import { makeTask, makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { attachments } from "../../src/db/schema";
import { R2Service } from "../../src/services/R2Service";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";

/**
 * Tests for `POST /api/v1/jobs/r2-purge` (§28 #4).
 *
 * Private DB `tms_jobs_test`, per-test DELETE reset. 🤖 internal-token auth.
 * Permanently deletes R2 objects + rows of attachments soft-deleted > 7 days
 * ago; R2 first then row; idempotent; `?dry_run=true` counts without deleting.
 */

const URL = "/api/v1/jobs/r2-purge";
const token = (): string => Config.INTERNAL_JOB_TOKEN ?? "";
const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 3600 * 1000);

const post = async (qs = "") =>
    (await oneOff())
        .post(`${URL}${qs}`)
        .set("X-Internal-Token", token())
        .send({});

const setupTask = async () => {
    const u = await makeUser();
    const task = await makeTask({ workspaceId: u.workspaceId, createdBy: u.id });
    return { task, uploadedBy: u.id };
};

/** Insert a raw COMPLETE attachment row with an explicit deleted_at / thumbnail. */
const seedAttachment = async (
    taskId: string,
    uploadedBy: string,
    opts: { deletedAt: Date | null; thumbnailKey?: string | null },
): Promise<string> => {
    const id = fakeId("att");
    await getDb()
        .insert(attachments)
        .values({
            id,
            taskId,
            name: "file.png",
            storageKey: `workspaces/ws/attachments/${id}.png`,
            mimeType: "image/png",
            sizeBytes: BigInt(456),
            uploadedBy,
            uploadStatus: "complete",
            uploadedAt: daysAgo(20),
            deletedAt: opts.deletedAt,
            thumbnailKey: opts.thumbnailKey ?? null,
        });
    return id;
};

const attachmentIds = async (): Promise<string[]> =>
    (await getDb().select().from(attachments)).map((r) => r.id);

describe("POST /api/v1/jobs/r2-purge", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("purges rows soft-deleted > 7 days ago; keeps recent-deleted + live", async () => {
            const { task, uploadedBy } = await setupTask();
            const old = await seedAttachment(task.id, uploadedBy, {
                deletedAt: daysAgo(8),
            });
            const recentlyDeleted = await seedAttachment(task.id, uploadedBy, {
                deletedAt: daysAgo(3),
            });
            const live = await seedAttachment(task.id, uploadedBy, {
                deletedAt: null,
            });

            const res = await post();

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.purged).toBe(1);
            expect(res.body.r2Errors).toBe(0);

            const ids = await attachmentIds();
            expect(ids).not.toContain(old);
            expect(ids).toContain(recentlyDeleted);
            expect(ids).toContain(live);
        });

        it("deletes BOTH the storage object and the thumbnail from R2", async () => {
            const spy = jest.spyOn(R2Service.prototype, "deleteObject");
            const { task, uploadedBy } = await setupTask();
            const id = await seedAttachment(task.id, uploadedBy, {
                deletedAt: daysAgo(8),
                thumbnailKey: "workspaces/ws/attachments/thumb-x.png",
            });

            await post();

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy).toHaveBeenCalledWith(expect.stringContaining(id));
            expect(spy).toHaveBeenCalledWith(
                "workspaces/ws/attachments/thumb-x.png",
            );
        });

        it("returns 0 when nothing is old enough", async () => {
            const { task, uploadedBy } = await setupTask();
            await seedAttachment(task.id, uploadedBy, { deletedAt: daysAgo(3) });
            const res = await post();
            expect(res.body.purged).toBe(0);
        });
    });

    // ─── dry_run ──────────────────────────────────────────────────────────────
    describe("dry_run", () => {
        it("counts but deletes nothing and makes no R2 calls", async () => {
            const spy = jest.spyOn(R2Service.prototype, "deleteObject");
            const { task, uploadedBy } = await setupTask();
            const old = await seedAttachment(task.id, uploadedBy, {
                deletedAt: daysAgo(8),
            });

            const res = await post("?dry_run=true");

            expect(res.body.dry_run).toBe(true);
            expect(res.body.wouldPurge).toBe(1);
            expect(await attachmentIds()).toContain(old);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    // ─── Idempotency ──────────────────────────────────────────────────────────
    describe("Idempotency", () => {
        it("a second run purges nothing more", async () => {
            const { task, uploadedBy } = await setupTask();
            await seedAttachment(task.id, uploadedBy, { deletedAt: daysAgo(8) });
            const first = await post();
            const second = await post();
            expect(first.body.purged).toBe(1);
            expect(second.body.purged).toBe(0);
        });
    });

    // ─── Auth ──────────────────────────────────────────────────────────────
    describe("Auth", () => {
        it("401 auth.unauthorized without the internal token", async () => {
            const res = await (await oneOff()).post(URL).send({});
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.unauthorized");
        });
    });

    // ─── Cross-cutting ──────────────────────────────────────────────────────
    describe("Cross-cutting", () => {
        it("responds as application/json with an X-Request-Id header", async () => {
            const res = await post();
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.get("X-Request-Id")).toMatch(/^req_/);
        });
    });
});
