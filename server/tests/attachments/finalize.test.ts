import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { oneOff } from "../test-utils/app";
import {
    makeWorkspace,
    makeUser,
    makeLoggedInClient,
    makeTask,
} from "../test-utils/factories";
import { getDb } from "../../src/db/client";
import { attachments, tasks } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import { R2Service } from "../../src/services/R2Service";
import type { Role } from "../../src/constants";

/**
 * Tests for `POST /api/v1/attachments/:id/finalize` (§16 #2). 🔐 any member.
 * HEAD-verifies the R2 object (missing → 410 attachment.upload_expired), flips
 * the row pending→complete (which bumps tasks.attachments_count via trigger),
 * and returns 200 with the Attachment. R2Service is the no-network stub in test;
 * the object-missing branch is forced via jest.spyOn(headObject).
 */

const PATH = (id: string) => `/api/v1/attachments/${id}/finalize`;

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", ...opts },
    );

interface AttSeed {
    id?: string;
    storageKey?: string;
    mimeType?: string;
    sizeBytes?: number;
    name?: string;
    uploadStatus?: "pending" | "complete";
    thumbnailKey?: string | null;
    deletedAt?: Date | null;
}

const seed = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    const insertAttachment = async (s: AttSeed = {}) => {
        const id = s.id ?? fakeId("att");
        const storageKey =
            s.storageKey ?? `workspaces/${ws.id}/attachments/${id}.jpg`;
        await getDb()
            .insert(attachments)
            .values({
                id,
                taskId: task.id,
                name: s.name ?? "file.jpg",
                storageKey,
                mimeType: s.mimeType ?? "image/jpeg",
                sizeBytes: BigInt(s.sizeBytes ?? 1000),
                uploadedBy: user.id,
                uploadStatus: s.uploadStatus ?? "pending",
                thumbnailKey: s.thumbnailKey ?? null,
                deletedAt: s.deletedAt ?? null,
            });
        return { id, storageKey };
    };
    return { ws, user, client, task, insertAttachment };
};

const rowById = async (id: string) => {
    const [row] = await getDb()
        .select()
        .from(attachments)
        .where(eq(attachments.id, id))
        .limit(1);
    return row;
};
const countOf = async (taskId: string): Promise<number> => {
    const [row] = await getDb()
        .select({ c: tasks.attachmentsCount })
        .from(tasks)
        .where(eq(tasks.id, taskId));
    return row.c;
};

// ════════════════════════════════════════════════════════════════════════════
describe("POST /api/v1/attachments/:id/finalize", () => {
    describe("Happy path", () => {
        it("200 flips pending→complete and returns the Attachment", async () => {
            const { client, insertAttachment } = await seed();
            const { id } = await insertAttachment();

            const res = await client.post(PATH(id)).send({});
            expect(res.status).toBe(200);
            expect(res.body.id).toBe(id);
            expect(res.body.url).toContain("https://r2.fake/get/");
            expect(res.body.thumbnail_url).toBeNull();
            expect((await rowById(id)).uploadStatus).toBe("complete");
        });

        it("bumps tasks.attachments_count by one on finalize", async () => {
            const { client, task, insertAttachment } = await seed();
            const { id } = await insertAttachment();
            const before = await countOf(task.id);
            await client.post(PATH(id)).send({});
            expect(await countOf(task.id)).toBe(before + 1);
        });

        it("sets thumbnail_key from the body and returns a thumbnail_url", async () => {
            const { client, ws, insertAttachment } = await seed();
            const { id } = await insertAttachment();
            const res = await client
                .post(PATH(id))
                .send({ thumbnail_key: `workspaces/${ws.id}/thumb/${id}.jpg` });
            expect(res.status).toBe(200);
            expect(res.body.thumbnail_url).toContain("https://r2.fake/get/");
            expect((await rowById(id)).thumbnailKey).toContain("thumb/");
        });

        it("exposes exactly the 9 Appendix-A wire keys", async () => {
            const { client, insertAttachment } = await seed();
            const { id } = await insertAttachment();
            const res = await client.post(PATH(id)).send({});
            expect(Object.keys(res.body).sort()).toEqual([
                "id",
                "mime_type",
                "name",
                "size_bytes",
                "task_id",
                "thumbnail_url",
                "uploaded_at",
                "uploaded_by",
                "url",
            ]);
        });
    });

    describe("HEAD verification", () => {
        it("410 attachment.upload_expired when the object is missing in R2", async () => {
            const { client, insertAttachment } = await seed();
            const { id } = await insertAttachment();
            const spy = jest
                .spyOn(R2Service.prototype, "headObject")
                .mockResolvedValue({ exists: false });

            const res = await client.post(PATH(id)).send({});
            expect(res.status).toBe(410);
            expect(res.body.error.code).toBe("attachment.upload_expired");
            // Row stays pending — not flipped.
            expect((await rowById(id)).uploadStatus).toBe("pending");
            spy.mockRestore();
        });

        it("does not bump the counter when the object is missing", async () => {
            const { client, task, insertAttachment } = await seed();
            const { id } = await insertAttachment();
            const spy = jest
                .spyOn(R2Service.prototype, "headObject")
                .mockResolvedValue({ exists: false });
            const before = await countOf(task.id);
            await client.post(PATH(id)).send({});
            expect(await countOf(task.id)).toBe(before);
            spy.mockRestore();
        });

        it("422 when body storage_key does not match the signed key", async () => {
            const { client, insertAttachment } = await seed();
            const { id } = await insertAttachment();
            const res = await client
                .post(PATH(id))
                .send({ storage_key: "workspaces/evil/attachments/x.jpg" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
        });
    });

    describe("Size + thumbnail policy (server-enforced)", () => {
        it("413 when the REAL object exceeds 25 MB even if the declared size was small", async () => {
            const { client, insertAttachment } = await seed();
            const { id } = await insertAttachment({ sizeBytes: 1000 });
            jest.spyOn(R2Service.prototype, "headObject").mockResolvedValue({
                exists: true,
                sizeBytes: 25 * 1024 * 1024 + 1,
            });
            const res = await client.post(PATH(id)).send({});
            expect(res.status).toBe(413);
            expect(res.body.error.code).toBe("attachment.too_large");
            // Not flipped to complete.
            expect((await rowById(id)).uploadStatus).toBe("pending");
        });

        it("reconciles size_bytes to the real object size from R2", async () => {
            const { client, insertAttachment } = await seed();
            const { id } = await insertAttachment({ sizeBytes: 1 });
            jest.spyOn(R2Service.prototype, "headObject").mockResolvedValue({
                exists: true,
                sizeBytes: 5000,
            });
            const res = await client.post(PATH(id)).send({});
            expect(res.status).toBe(200);
            expect(res.body.size_bytes).toBe(5000);
            expect(Number((await rowById(id)).sizeBytes)).toBe(5000);
        });

        it("422 when thumbnail_key points outside the caller's workspace (cross-tenant exfil guard)", async () => {
            const { client, insertAttachment } = await seed();
            const { id } = await insertAttachment();
            const res = await client
                .post(PATH(id))
                .send({ thumbnail_key: "workspaces/ws-victim/attachments/secret.jpg" });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe("validation.failed");
            expect((await rowById(id)).uploadStatus).toBe("pending");
        });

        it("rejects a storage_key mismatch BEFORE calling HEAD", async () => {
            const { client, insertAttachment } = await seed();
            const { id } = await insertAttachment();
            const headSpy = jest.spyOn(R2Service.prototype, "headObject");
            const res = await client
                .post(PATH(id))
                .send({ storage_key: "workspaces/x/wrong.jpg" });
            expect(res.status).toBe(422);
            expect(headSpy).not.toHaveBeenCalled();
        });

        it("re-verifies via HEAD on EVERY finalize (a later vanished object → 410)", async () => {
            const { client, insertAttachment } = await seed();
            const { id } = await insertAttachment();
            expect((await client.post(PATH(id)).send({})).status).toBe(200);
            jest.spyOn(R2Service.prototype, "headObject").mockResolvedValue({
                exists: false,
            });
            const res = await client.post(PATH(id)).send({});
            expect(res.status).toBe(410);
        });
    });

    describe("Idempotency", () => {
        it("finalizing twice is idempotent and bumps the counter only once", async () => {
            const { client, task, insertAttachment } = await seed();
            const { id } = await insertAttachment();
            const before = await countOf(task.id);
            const a = await client.post(PATH(id)).send({});
            const b = await client.post(PATH(id)).send({});
            expect(a.status).toBe(200);
            expect(b.status).toBe(200);
            expect(await countOf(task.id)).toBe(before + 1);
        });
    });

    describe("Authentication", () => {
        it("401 with no credentials", async () => {
            const { insertAttachment } = await seed();
            const { id } = await insertAttachment();
            const http = await oneOff();
            const res = await http.post(PATH(id)).send({});
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe("auth.missing_token");
        });

        it("401 auth.expired_token for an expired token", async () => {
            const { user, insertAttachment } = await seed();
            const { id } = await insertAttachment();
            const expired = signAccess(user, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .post(PATH(id))
                .set("Authorization", `Bearer ${expired}`)
                .send({});
            expect(res.status).toBe(401);
        });
    });

    describe("Not-found & tenant isolation", () => {
        it("404 attachment.not_found for a non-existent id", async () => {
            const { client } = await seed();
            const res = await client.post(PATH(fakeId("att"))).send({});
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("attachment.not_found");
        });

        it("404 for a soft-deleted attachment", async () => {
            const { client, insertAttachment } = await seed();
            const { id } = await insertAttachment({ deletedAt: new Date() });
            const res = await client.post(PATH(id)).send({});
            expect(res.status).toBe(404);
        });

        it("404 when the attachment's task is in another workspace", async () => {
            const a = await seed();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id });
            const taskB = await makeTask({ workspaceId: wsB.id, createdBy: userB.id });
            const bId = fakeId("att");
            await getDb()
                .insert(attachments)
                .values({
                    id: bId,
                    taskId: taskB.id,
                    name: "b.jpg",
                    storageKey: "k",
                    mimeType: "image/jpeg",
                    sizeBytes: BigInt(10),
                    uploadedBy: userB.id,
                    uploadStatus: "pending",
                });
            const res = await a.client.post(PATH(bId)).send({});
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("attachment.not_found");
        });
    });

    describe("Validation & cross-cutting", () => {
        it("422 when id exceeds 64 chars", async () => {
            const { client } = await seed();
            const res = await client.post(PATH("a".repeat(65))).send({});
            expect(res.status).toBe(422);
            expect(res.body.error.details[0].field).toBe("id");
        });

        it("echoes a client X-Request-Id", async () => {
            const { client, insertAttachment } = await seed();
            const { id } = await insertAttachment();
            const res = await client
                .post(PATH(id))
                .set("X-Request-Id", "rid-fin-1")
                .send({});
            expect(res.get("x-request-id")).toBe("rid-fin-1");
        });
    });
});
