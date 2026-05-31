import { oneOff } from "../test-utils/app";
import { makeTask, makeUser } from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { attachments } from "../../src/db/schema";
import { R2Service } from "../../src/services/R2Service";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";

/**
 * Tests for `POST /api/v1/jobs/attachment-janitor` (§28 #3).
 *
 * Private DB `tms_jobs_test`, per-test DELETE reset. 🤖 internal-token auth.
 * Hard-deletes `pending` attachments older than 1h (never finalised); best-effort
 * R2 cleanup; idempotent; `?dry_run=true` counts without deleting.
 */

const URL = "/api/v1/jobs/attachment-janitor";
const token = (): string => Config.INTERNAL_JOB_TOKEN ?? "";
const hoursAgo = (n: number): Date => new Date(Date.now() - n * 3600 * 1000);
const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60 * 1000);

const post = async (qs = "") =>
    (await oneOff())
        .post(`${URL}${qs}`)
        .set("X-Internal-Token", token())
        .send({});

/** Insert a raw attachment row (no factory exists; uploadedAt/uploadStatus are settable). */
const seedAttachment = async (
    taskId: string,
    uploadedBy: string,
    opts: { uploadStatus: "pending" | "complete"; uploadedAt: Date },
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
            sizeBytes: BigInt(123),
            uploadedBy,
            uploadStatus: opts.uploadStatus,
            uploadedAt: opts.uploadedAt,
        });
    return id;
};

const attachmentIds = async (): Promise<string[]> =>
    (await getDb().select().from(attachments)).map((r) => r.id);

describe("POST /api/v1/jobs/attachment-janitor", () => {
    // ─── a. Happy path ──────────────────────────────────────────────────────
    describe("Happy path", () => {
        it("hard-deletes pending attachments older than 1h; keeps recent-pending + complete", async () => {
            const u = await makeUser();
            const task = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const stale = await seedAttachment(task.id, task.createdBy, {
                uploadStatus: "pending",
                uploadedAt: hoursAgo(2),
            });
            const recent = await seedAttachment(task.id, task.createdBy, {
                uploadStatus: "pending",
                uploadedAt: minutesAgo(10),
            });
            const complete = await seedAttachment(task.id, task.createdBy, {
                uploadStatus: "complete",
                uploadedAt: hoursAgo(5),
            });

            const res = await post();

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.dry_run).toBe(false);
            expect(res.body.deleted).toBe(1);
            expect(res.body.processed).toBe(1);

            const ids = await attachmentIds();
            expect(ids).not.toContain(stale);
            expect(ids).toContain(recent);
            expect(ids).toContain(complete);
        });

        it("best-effort deletes the abandoned R2 object for each stale row", async () => {
            const spy = jest.spyOn(R2Service.prototype, "deleteObject");
            const u = await makeUser();
            const task = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const stale = await seedAttachment(task.id, task.createdBy, {
                uploadStatus: "pending",
                uploadedAt: hoursAgo(2),
            });

            await post();

            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith(expect.stringContaining(stale));
        });

        it("returns 0 when nothing is stale", async () => {
            const u = await makeUser();
            const task = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedAttachment(task.id, task.createdBy, {
                uploadStatus: "pending",
                uploadedAt: minutesAgo(5),
            });
            const res = await post();
            expect(res.body.deleted).toBe(0);
            expect(res.body.processed).toBe(0);
        });
    });

    // ─── dry_run ──────────────────────────────────────────────────────────────
    describe("dry_run", () => {
        it("counts but deletes nothing and makes no R2 calls", async () => {
            const spy = jest.spyOn(R2Service.prototype, "deleteObject");
            const u = await makeUser();
            const task = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            const stale = await seedAttachment(task.id, task.createdBy, {
                uploadStatus: "pending",
                uploadedAt: hoursAgo(2),
            });

            const res = await post("?dry_run=true");

            expect(res.status).toBe(200);
            expect(res.body.dry_run).toBe(true);
            expect(res.body.wouldDelete).toBe(1);
            expect(res.body.processed).toBe(1);
            expect(await attachmentIds()).toContain(stale);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    // ─── Idempotency ──────────────────────────────────────────────────────────
    describe("Idempotency", () => {
        it("a second run deletes nothing more", async () => {
            const u = await makeUser();
            const task = await makeTask({
                workspaceId: u.workspaceId,
                createdBy: u.id,
            });
            await seedAttachment(task.id, task.createdBy, {
                uploadStatus: "pending",
                uploadedAt: hoursAgo(2),
            });
            const first = await post();
            const second = await post();
            expect(first.body.deleted).toBe(1);
            expect(second.body.deleted).toBe(0);
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
