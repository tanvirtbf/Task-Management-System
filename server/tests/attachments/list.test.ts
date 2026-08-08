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
import { attachments } from "../../src/db/schema";
import { fakeId } from "../../src/utils";
import { Config } from "../../src/config";
import type { Role } from "../../src/constants";

/**
 * Tests for `GET /api/v1/tasks/:id/attachments` (§16 #3). 🔐 any member. Returns
 * a BARE `Attachment[]` (the §16 array shape) of finalised, non-deleted rows,
 * newest first. Each `url` is a fresh signed GET (r2.fake/get in test).
 */

const PATH = (id: string) => `/api/v1/tasks/${id}/attachments`;

const signAccess = (
    user: { id: string; workspaceId: string; role: Role },
    secret: string,
    opts: jwt.SignOptions = {},
): string =>
    jwt.sign(
        { sub: user.id, role: user.role, workspaceId: user.workspaceId },
        secret,
        { algorithm: "HS256", expiresIn: "15m", ...opts },
    );

interface AttSeed {
    id?: string;
    name?: string;
    uploadStatus?: "pending" | "complete";
    deletedAt?: Date | null;
    uploadedAt?: Date;
}

const seed = async (role: Role = "member") => {
    const ws = await makeWorkspace();
    const user = await makeUser({ workspaceId: ws.id, role });
    const client = await makeLoggedInClient(user);
    const task = await makeTask({ workspaceId: ws.id, createdBy: user.id });
    const add = async (s: AttSeed = {}) => {
        const id = s.id ?? fakeId("att");
        await getDb()
            .insert(attachments)
            .values({
                id,
                taskId: task.id,
                name: s.name ?? `file-${id}.jpg`,
                storageKey: `workspaces/${ws.id}/attachments/${id}.jpg`,
                mimeType: "image/jpeg",
                sizeBytes: BigInt(2048),
                uploadedBy: user.id,
                uploadStatus: s.uploadStatus ?? "complete",
                deletedAt: s.deletedAt ?? null,
                ...(s.uploadedAt ? { uploadedAt: s.uploadedAt } : {}),
            });
        return { id };
    };
    return { ws, user, client, task, add };
};

const ATTACHMENT_KEYS = [
    "id",
    "mime_type",
    "name",
    "size_bytes",
    "task_id",
    "thumbnail_url",
    "uploaded_at",
    "uploaded_by",
    "url",
];
const idsOf = (body: Array<{ id: string }>) => body.map((r) => r.id);

// ════════════════════════════════════════════════════════════════════════════
describe("GET /api/v1/tasks/:id/attachments", () => {
    describe("Happy path", () => {
        it("returns a bare array (not a {data} envelope)", async () => {
            const { client, task, add } = await seed();
            await add();
            const res = await client.get(PATH(task.id));
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body).not.toHaveProperty("data");
            expect(res.body).not.toHaveProperty("pagination");
        });

        it("each item carries exactly the 9 wire keys (no storage_key/upload_status leak)", async () => {
            const { client, task, add } = await seed();
            await add();
            const res = await client.get(PATH(task.id));
            expect(Object.keys(res.body[0]).sort()).toEqual(ATTACHMENT_KEYS);
            const raw = JSON.stringify(res.body[0]);
            expect(raw).not.toContain("storage_key");
            expect(raw).not.toContain("upload_status");
            expect(raw).not.toContain("deleted_at");
            expect(res.body[0].url).toContain("https://r2.fake/get/");
        });

        it("returns 200 [] (not 404) for a task with no attachments", async () => {
            const { client, task } = await seed();
            const res = await client.get(PATH(task.id));
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it("orders newest-first by uploaded_at", async () => {
            const { client, task, add } = await seed();
            await add({ id: "att-old", uploadedAt: new Date("2024-01-01T00:00:00Z") });
            await add({ id: "att-new", uploadedAt: new Date("2024-06-01T00:00:00Z") });
            await add({ id: "att-mid", uploadedAt: new Date("2024-03-01T00:00:00Z") });
            const res = await client.get(PATH(task.id));
            expect(idsOf(res.body)).toEqual(["att-new", "att-mid", "att-old"]);
        });
    });

    describe("Exclusions", () => {
        it("excludes pending (unfinalised) attachments", async () => {
            const { client, task, add } = await seed();
            await add({ id: "att-done", uploadStatus: "complete" });
            await add({ id: "att-pending", uploadStatus: "pending" });
            const res = await client.get(PATH(task.id));
            expect(idsOf(res.body)).toEqual(["att-done"]);
        });

        it("excludes soft-deleted attachments", async () => {
            const { client, task, add } = await seed();
            await add({ id: "att-live" });
            await add({ id: "att-gone", deletedAt: new Date() });
            const res = await client.get(PATH(task.id));
            expect(idsOf(res.body)).toEqual(["att-live"]);
        });
    });

    describe("Authentication & authorization", () => {
        it("401 with no credentials", async () => {
            const { task } = await seed();
            const http = await oneOff();
            const res = await http.get(PATH(task.id));
            expect(res.status).toBe(401);
        });

        it("401 auth.expired_token for an expired token", async () => {
            const { user, task } = await seed();
            const expired = signAccess(user, Config.ACCESS_TOKEN_SECRET!, {
                expiresIn: -10,
            });
            const http = await oneOff();
            const res = await http
                .get(PATH(task.id))
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).toBe(401);
        });

        it.each(["owner", "admin", "member", "guest"] as Role[])(
            "allows a %s to read (200)",
            async (role) => {
                const { client, task, add } = await seed(role);
                await add();
                const res = await client.get(PATH(task.id));
                expect(res.status).toBe(200);
                expect(res.body).toHaveLength(1);
            },
        );
    });

    describe("Not-found & tenant isolation", () => {
        it("404 task.not_found for a non-existent task", async () => {
            const { client } = await seed();
            const res = await client.get(PATH(fakeId("t")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });

        it("404 + no leak when the task is in another workspace", async () => {
            const a = await seed();
            const wsB = await makeWorkspace();
            const userB = await makeUser({ workspaceId: wsB.id });
            const taskB = await makeTask({ workspaceId: wsB.id, createdBy: userB.id });
            await getDb()
                .insert(attachments)
                .values({
                    id: fakeId("att"),
                    taskId: taskB.id,
                    name: "secret-b.jpg",
                    storageKey: "k",
                    mimeType: "image/jpeg",
                    sizeBytes: BigInt(1),
                    uploadedBy: userB.id,
                    uploadStatus: "complete",
                });
            const res = await a.client.get(PATH(taskB.id));
            expect(res.status).toBe(404);
            expect(JSON.stringify(res.body)).not.toContain("secret-b.jpg");
        });
    });

    describe("Validation, side-effects, cross-cutting", () => {
        it("422 when id exceeds 64 chars", async () => {
            const { client } = await seed();
            const res = await client.get(PATH("a".repeat(65)));
            expect(res.status).toBe(422);
            expect(res.body.error.details[0].field).toBe("id");
        });

        it("a read writes no attachment rows", async () => {
            const { client, task, add } = await seed();
            await add();
            const before = (
                await getDb()
                    .select()
                    .from(attachments)
                    .where(eq(attachments.taskId, task.id))
            ).length;
            await client.get(PATH(task.id));
            const after = (
                await getDb()
                    .select()
                    .from(attachments)
                    .where(eq(attachments.taskId, task.id))
            ).length;
            expect(after).toBe(before);
        });

        it("treats a SQL-injection id as a literal (404, no 500)", async () => {
            const { client } = await seed();
            const res = await client.get(PATH(encodeURIComponent("' OR '1'='1")));
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("task.not_found");
        });
    });
});
